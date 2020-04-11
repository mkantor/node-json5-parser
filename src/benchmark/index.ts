import * as fs from 'fs';
import { parse } from '../main';

const iterations = 10;

const data = fs.readFileSync(
	`${__dirname}/../../../src/benchmark/466K.json`,
	'utf8'
);

const before = new Date();
console.log('Started benchmarking at', before);
process.stdout.write(`Running ${iterations} iterations`);
for (let iteration = 0; iteration < iterations; iteration++) {
	parse(data);
	process.stdout.write('.');
}
const after = new Date();
console.log('\nEnded benchmarking at', after);

const average = (after.getTime() - before.getTime()) / iterations;
console.log(`
Average elapsed time: ${average}ms
`);
