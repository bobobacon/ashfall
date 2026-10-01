// Executable entrypoint: node dist/main.js
import { main } from "./app.js";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
