import ts from "typescript";

ts.version

const abcdef: string = "asdf";
console.log(abcdef);

const x = ({a, b}: { a: number; b: number; }) => a * b