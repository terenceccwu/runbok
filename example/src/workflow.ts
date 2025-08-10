type InputC = {
  a: number;
  b: number;
};
import os from "os";
import { hello } from "./lib1";
import { hello_world } from "./lib2";

type Input = {
  a: any;
  b: any;
};

type Output = Input & {
  c: any;
  d: any;
  e: any;
  f: any;
  g: any;
  h: any;
};

const compute_c = ({a, b}: InputC) => a * b;

const compute_d = ({ c }) => Math.floor(Math.random() * 100) * c;

const compute_e = async ({ d }) => fetch(`https://httpbin.org/anything?num=${d}`).then(r => r.json());

const compute_f = () => os.platform();

const compute_g = () => hello;

const compute_h = () => hello_world;

const main = async (input: Input): Promise<Output> => {
  const ctx = Object.assign({}, input) as Output;
  ctx["c"] = await compute_c(ctx); // depends on: a, b
  ctx["d"] = await compute_d(ctx); // depends on: c
  ctx["e"] = await compute_e(ctx); // depends on: d
  ctx["f"] = await compute_f(ctx);
  ctx["g"] = await compute_g(ctx);
  ctx["h"] = await compute_h(ctx);
  return ctx;
};

export default main;
