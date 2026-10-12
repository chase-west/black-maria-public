// Prints the worked example section of docs/RULES.md. Usage: tsx --conditions=source scripts/worked-example.ts [--search]
import { EXAMPLE, exampleAt, findExample, renderExample } from "../test/worked-example.js";

const ex = process.argv.includes("--search") ? findExample() : exampleAt(EXAMPLE.seed, EXAMPLE.from);
console.log(renderExample(ex));
