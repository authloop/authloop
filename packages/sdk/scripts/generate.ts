import fs from "node:fs";
import path from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const OPENAPI_URL =
  process.env.AUTHLOOP_OPENAPI_URL ?? "https://api.authloop.ai/openapi.json";

async function main() {
  console.log(`Fetching OpenAPI spec from ${OPENAPI_URL}...`);

  const ast = await openapiTS(new URL(OPENAPI_URL));
  const output = astToString(ast);

  const outPath = path.join(import.meta.dirname, "../src/types.generated.ts");
  fs.writeFileSync(
    outPath,
    `// Auto-generated from ${OPENAPI_URL}\n// Do not edit manually\n\n${output}`,
  );

  console.log(`Types written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
