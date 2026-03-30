/**
 * prompt.ts
 * Hidden input prompt — no echo, no display of typed/pasted content.
 * Shows a word counter bar when totalWords > 0.
 */

import * as readline from "readline";

export function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export function promptHidden(question: string, totalWords = 0): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`\n  ${question}\n  `);

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let input = "";

    const countWords = (text: string) =>
      text.trim() === "" ? 0 : text.trim().split(/\s+/).length;

    const updateCounter = () => {
      if (totalWords === 0) return;
      const wordCount = countWords(input);
      const remaining = Math.max(0, totalWords - wordCount);
      const filled = Math.min(wordCount, totalWords);
      const bar = "█".repeat(filled) + "░".repeat(totalWords - filled);
      let status: string;
      if (wordCount === 0) status = "Start typing...";
      else if (wordCount < totalWords) status = `${wordCount} words · ${remaining} missing`;
      else if (wordCount === totalWords) status = `${totalWords} words — press Enter`;
      else status = `${wordCount} words (too many)`;
      process.stdout.write(`\r  ${bar}  ${status}  `);
    };

    updateCounter();

    const onData = (chunk: string) => {
      const enterIdx = chunk.indexOf("\r") !== -1 ? chunk.indexOf("\r") : chunk.indexOf("\n");
      if (enterIdx !== -1) {
        const before = chunk.slice(0, enterIdx);
        if (before.length > 0) input += before;
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input.trim());
        return;
      }
      if (chunk === "\u0003") {
        process.stdout.write("\n");
        process.exit(0);
      } else if (chunk === "\u007f" || chunk === "\b") {
        if (input.length > 0) { input = input.slice(0, -1); updateCounter(); }
      } else {
        input += chunk;
        updateCounter();
      }
    };

    process.stdin.on("data", onData);
  });
}
