# IronCalc Web bindings

This package contains web bindings for IronCalc. Note that it does not contain the xlsx writer and reader, only the engine. For XLSX import and export, use [`@ironcalc/wasm-xlsx`](https://www.npmjs.com/package/@ironcalc/wasm-xlsx).


## Usage

In your project

```
npm install @ironcalc/wasm
```

And then in your TypeScript

```TypeScript
import init, { Model } from "@ironcalc/wasm";

await init();

function compute() {
    const model = new Model('en', 'UTC');
    
    model.setUserInput(0, 1, 1, "23");
    model.setUserInput(0, 1, 2, "=A1*3+1");
    
    const result = model.getFormattedCellValue(0, 1, 2);
    
    console.log("Result: ", result);
}

compute();
```
