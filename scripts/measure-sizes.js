const fs = require('fs');
const path = require('path');

const artifactsDir = path.join(__dirname, '..', 'artifacts', 'contracts');

function walkDir(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...walkDir(full));
    else if (e.isFile() && e.name.endsWith('.json')) files.push(full);
  }
  return files;
}

const files = walkDir(artifactsDir);
const sizes = [];
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const contract = j.contractName || path.basename(f);
    const deployed = j.deployedBytecode || (j.deployedBytecode && j.deployedBytecode.object) || j.evm && j.evm.deployedBytecode && j.evm.deployedBytecode.object;
    let bytes = 0;
    if (deployed && typeof deployed === 'string') {
      // strip 0x
      const hex = deployed.startsWith('0x') ? deployed.slice(2) : deployed;
      bytes = Math.ceil(hex.length / 2);
    }
    sizes.push({ file: f, contract, bytes });
  } catch (err) {
    // ignore
  }
}

sizes.sort((a,b) => b.bytes - a.bytes);
console.log('Top contracts by deployed bytecode size:');
console.log('bytes\tcontract\tfile');
for (let i=0;i<Math.min(30, sizes.length); i++) {
  const s = sizes[i];
  console.log(`${s.bytes}\t${s.contract}\t${path.relative(process.cwd(), s.file)}`);
}

// print AggregatorUpgradeable if present
const agg = sizes.find(s => s.contract === 'AggregatorUpgradeable' || s.file.includes('AggregatorUpgradeable'));
if (agg) console.log('\nAggregator artifact: ', agg);
