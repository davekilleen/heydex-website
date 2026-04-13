#!/usr/bin/env node
/**
 * Seed Convex database with Dave's profile and diffs
 * Safe to run multiple times (idempotent)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SEED_DATA_PATH = path.join(__dirname, '../seed-data/dave-diffs.json');
const CONVEX_URL = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;

console.log('🌱 Seeding Convex database...\n');

// Load seed data
const seedData = JSON.parse(fs.readFileSync(SEED_DATA_PATH, 'utf8'));

console.log('Loaded seed data:');
console.log(`  User: ${seedData.user.displayName} (@${seedData.user.handle})`);
console.log(`  Diffs: ${seedData.diffs.length} workflows\n`);

// Use Convex CLI to run mutations
try {
  console.log('Step 1: Seed user profile...');
  
  const seedUserCmd = `npx convex run seed:seedDave --prod`;
  const userResult = execSync(seedUserCmd, { 
    encoding: 'utf8',
    stdio: 'inherit'
  });
  
  console.log('✓ User seeded\n');

  console.log('Step 2: Seed diffs...');
  
  for (const diff of seedData.diffs) {
    console.log(`  Seeding: ${diff.name}...`);
    
    const args = [
      `diffId="${diff.diffId}"`,
      `name="${diff.name}"`,
      `description="${diff.description}"`,
      `methodology="${diff.methodology}"`,
      `tags='${JSON.stringify(diff.tags)}'`,
      `roles='${JSON.stringify(diff.roles)}'`,
      `integrations='${JSON.stringify(diff.integrations)}'`
    ].join(' ');
    
    const seedDiffCmd = `npx convex run seed:seedDiff ${args} --prod`;
    
    try {
      execSync(seedDiffCmd, { 
        encoding: 'utf8',
        stdio: 'pipe'  // Suppress verbose output
      });
      console.log(`    ✓ ${diff.name}`);
    } catch (err) {
      console.log(`    ⚠️  ${diff.name} (may already exist)`);
    }
  }
  
  console.log('\n✅ Database seeded successfully');
  console.log(`\n📊 Summary:`);
  console.log(`  User: Dave Killeen`);
  console.log(`  Diffs: ${seedData.diffs.length} workflows`);
  console.log(`\nVerify: https://heydex.ai/diff/`);
  
} catch (error) {
  console.error('\n❌ Seeding failed:', error.message);
  console.error('\nTry running manually via Convex dashboard:');
  console.error('  npm run convex:dashboard');
  process.exit(1);
}
