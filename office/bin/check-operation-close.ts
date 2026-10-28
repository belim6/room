import { Allowlist, config } from '../collect/privacy';
import { operationTree } from '../collect/operations';

const cfg = config();
const tree = operationTree(cfg.operations, new Allowlist(cfg), []);
if (!tree || tree.error) {
  console.error(tree?.error || `operations.json not found: ${cfg.operations}`);
  process.exitCode = 1;
} else {
  const problems = tree.nodes.filter(node => node.closeProblems?.length);
  if (!problems.length) console.log('Operation close records: no problems.');
  for (const node of problems) {
    console.log(`${node.id}:`);
    for (const problem of node.closeProblems || []) console.log(`  - ${problem}`);
  }
  if (problems.length) process.exitCode = 1;
}
