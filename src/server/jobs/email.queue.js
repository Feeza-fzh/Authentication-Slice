/**
 * Background Email Job Queue
 * Asynchronously processes email delivery jobs without blocking the HTTP request/response cycle.
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const { sendVerificationEmail } = require('../email.service');

class EmailJobQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.isProcessing = false;
    this.jobs = new Map(); // Tracks job history & status
    this.maxRetries = 3;
  }

  /**
   * Enqueue a new email job. Returns immediately with the jobId.
   *
   * @param {object} options
   * @param {string} options.type - e.g. 'SEND_VERIFICATION_EMAIL'
   * @param {object} options.payload - Job data { to, code, name }
   * @returns {string} jobId
   */
  enqueue({ type, payload }) {
    const jobId = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const job = {
      id: jobId,
      type,
      payload,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
      error: null,
      result: null
    };

    this.jobs.set(jobId, job);
    this.queue.push(job);
    this.emit('job:enqueued', job);

    // Trigger queue worker in the background asynchronously
    setImmediate(() => this.processNext());

    return jobId;
  }

  /**
   * Worker loop to process the next job in line.
   */
  async processNext() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const job = this.queue.shift();
    job.status = 'processing';
    job.attempts += 1;
    this.emit('job:processing', job);

    try {
      console.log(`\n📧 [EmailQueue] Processing email job for ${job.payload.to}...`);
      if (job.type === 'SEND_VERIFICATION_EMAIL') {
        const result = await sendVerificationEmail({
          to: job.payload.to,
          code: job.payload.code,
          name: job.payload.name
        });
        job.result = result;

        if (result.devWarning) {
          console.warn(`⚠️ [EmailQueue Notice] Real SMTP was skipped (${result.devWarning}). Simulated verification code: ${job.payload.code}`);
        } else if (result.messageId) {
          console.log(`✅ [EmailQueue Success] Email sent via SMTP to ${job.payload.to}! Message ID: ${result.messageId}`);
        } else {
          console.log(`ℹ️ [EmailQueue Dev Mode] Email captured locally. Verification code for ${job.payload.to}: ${job.payload.code}`);
        }
      } else {
        throw new Error(`Unknown job type: ${job.type}`);
      }

      job.status = 'completed';
      job.completedAt = new Date();
      this.emit('job:completed', job);
    } catch (err) {
      console.error(`❌ [EmailQueue Error] Failed to send email to ${job.payload.to}:`, err.message);
      job.error = err.message;

      if (job.attempts < this.maxRetries) {
        job.status = 'retrying';
        this.emit('job:retrying', job);
        // Retry after backoff
        setTimeout(() => {
          this.queue.push(job);
          this.processNext();
        }, 1000 * job.attempts);
      } else {
        job.status = 'failed';
        job.failedAt = new Date();
        this.emit('job:failed', job);
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }

  /**
   * Retrieves the current status of a job
   * @param {string} jobId
   */
  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Clears the queue and completed job history (useful for test resets)
   */
  clear() {
    this.queue = [];
    this.jobs.clear();
    this.isProcessing = false;
  }
}

// Singleton email queue instance
const emailQueue = new EmailJobQueue();

module.exports = {
  EmailJobQueue,
  emailQueue
};
