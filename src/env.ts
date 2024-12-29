export function loadStrict(environmentVariable: string): string {
  const envVariable = process.env[environmentVariable];
  if (!envVariable || envVariable.length === 0) {
    throw new Error(
      `Environment variable [${environmentVariable}] cannot be found`,
    );
  }
  return envVariable;
}
