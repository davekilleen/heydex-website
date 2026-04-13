#!/usr/bin/env node
/**
 * Check if Convex database has required data
 * Exits 0 if healthy, 1 if needs seeding
 */

const https = require('https');

const CONVEX_URL = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;

if (!CONVEX_URL) {
  console.error('❌ CONVEX_URL not set');
  process.exit(1);
}

console.log('🔍 Checking database health...\n');

// Query for diffs via Convex HTTP API
const queryData = JSON.stringify({
  path: 'diffs:list',
  args: {},
  format: 'json'
});

const url = new URL(CONVEX_URL);
const options = {
  hostname: url.hostname,
  path: '/api/query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': queryData.length
  }
};

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      
      if (result.status === 'success') {
        const diffs = result.value || [];
        
        console.log(`Found ${diffs.length} diffs in database`);
        
        if (diffs.length === 0) {
          console.log('❌ Database is empty\n');
          console.log('Run: npm run seed-deploy');
          process.exit(1);
        } else if (diffs.length < 7) {
          console.log('⚠️  Expected 7 diffs, found', diffs.length);
          console.log('Database may be partially seeded\n');
          process.exit(1);
        } else {
          console.log('✅ Database healthy\n');
          console.log('Diffs:');
          diffs.forEach(d => {
            console.log(`  - ${d.name} (@${d.authorHandle})`);
          });
          process.exit(0);
        }
      } else {
        console.error('❌ Query failed:', result.error || 'Unknown error');
        process.exit(1);
      }
    } catch (err) {
      console.error('❌ Failed to parse response:', err.message);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('❌ Network error:', err.message);
  console.log('\nConvex backend may be unreachable');
  process.exit(1);
});

req.write(queryData);
req.end();
