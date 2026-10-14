/**
 * Database Connection Manager with Connection Pooling
 * Groups multiple incoming user requests into a single, managed database connection pool
 * using Neon's PgBouncer pooler and Prisma connection limit configuration.
 *
 * Benefits:
 * 1. Groups multiple incoming requests into a shared pool instead of opening separate connections.
 * 2. Reduces database and server CPU usage and lowers hosting costs.
 * 3. Prevents connection exhaustion and application slowdowns under heavy traffic.
 */

require('dotenv').config();

let PrismaClient;
try {
  PrismaClient = require('@prisma/client').PrismaClient;
} catch (e) {
  PrismaClient = null;
}

/**
 * Returns DATABASE_URL configured with PgBouncer connection pooling flags
 */
function getPooledDatabaseUrl() {
  const originalUrl = process.env.DATABASE_URL || '';
  if (!originalUrl) return originalUrl;

  try {
    const url = new URL(originalUrl);
    // Enable pgbouncer transaction mode compatibility when connecting via pooler
    if (url.hostname.includes('pooler') && !url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
    // Set connection limit to group incoming requests (default: 10 pooled connections)
    if (!url.searchParams.has('connection_limit')) {
      const limit = process.env.DB_POOL_LIMIT || '10';
      url.searchParams.set('connection_limit', limit);
    }
    // Set pool timeout in seconds
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '20');
    }
    return url.toString();
  } catch (err) {
    return originalUrl;
  }
}

// Singleton pooled PrismaClient instance
let prisma = null;
if (PrismaClient) {
  try {
    const pooledUrl = getPooledDatabaseUrl();
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: pooledUrl
        }
      },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
    });
    console.log('🔌 [Database Pool] Initialized pooled PrismaClient (PgBouncer mode, connection_limit=10)');
  } catch (err) {
    console.warn('⚠️ [Database Pool] Could not initialize pooled PrismaClient:', err.message);
  }
}

module.exports = {
  prisma,
  getPooledDatabaseUrl
};
