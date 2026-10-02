import { judgeAnswer } from "./judge-wasm-server.mjs";

const prompt = "What can you enter without going in?";
const r = await judgeAnswer("A competition", prompt);
console.log("main-thread direct call:", r.score);
console.log("browser value:          49.67104671175759");
console.log("worker (HTTP) value:    49.67103479134464");
console.log("DONE");
