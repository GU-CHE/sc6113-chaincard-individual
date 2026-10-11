const fs = require('node:fs');
const solc = require('solc');
const source = fs.readFileSync('contracts/Donation.sol', 'utf8');
const output = JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Donation.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
for (const error of output.errors || []) { if (error.severity === 'error') throw new Error(error.formattedMessage); }
const result = output.contracts['Donation.sol'].Donation;
fs.writeFileSync('static/Donation.json', JSON.stringify({compiler:solc.version(),evmVersion:'shanghai',optimizerRuns:200,abi:result.abi,bytecode:'0x'+result.evm.bytecode.object}, null, 2));
fs.mkdirSync('static/vendor',{recursive:true});
fs.copyFileSync('node_modules/ethers/dist/ethers.umd.min.js','static/vendor/ethers.umd.min.js');
fs.copyFileSync('node_modules/ethers/LICENSE.md','static/vendor/ethers-LICENSE.md');
console.log('Compiled Donation.sol; ABI, bytecode and local ethers bundle written.');
