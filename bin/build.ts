import { Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";

export function extractNodeMajorVersion() {
  const [major, _minor, _patch] = process.versions.node.split(".").map(Number);

  console.log(`Using Node.js version "${major}" from mise.toml`);

  return major;
}

/**
 * This namespace contains build-related constants.
 * It is separated from static constants to avoid being bundled by esbuild.
 * Bundling this file would cause issues with dynamic Node.js version extraction as the mise.toml is not included in the final bundle.
 */
export namespace Build {
  export const NODE_VERSION = extractNodeMajorVersion();
  export const NODE_LAMBDA_RUNTIME = new Runtime(
    `nodejs${NODE_VERSION}.x`,
    RuntimeFamily.NODEJS,
  );
}

export const NODEJS_BUNDLING_BANNER =
  "import { createRequire } from 'module';const require = createRequire(import.meta.url);import {dirname} from 'path';import { fileURLToPath, pathToFileURL } from 'url';const __dirname = dirname(fileURLToPath(import.meta.url))";
