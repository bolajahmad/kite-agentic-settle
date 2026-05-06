/**
 * Annotated logger for progressive narrative examples.
 * Provides clear [STEP] markers and structured output.
 */

export class Logger {
  private stepCounter = 0;

  /**
   * Log a step in the narrative with clear annotation
   */
  step(message: string): void {
    this.stepCounter++;
    console.log(`\n[STEP ${this.stepCounter}] ${message}`);
  }

  /**
   * Log informational details under current step
   */
  info(message: string): void {
    console.log(`    ${message}`);
  }

  /**
   * Log success message
   */
  success(message: string): void {
    console.log(`   ${message}`);
  }

  /**
   * Log warning message
   */
  warn(message: string): void {
    console.log(`    ${message}`);
  }

  /**
   * Log error message
   */
  error(message: string): void {
    console.log(`   ${message}`);
  }

  /**
   * Log JSON data with pretty formatting
   */
  data(label: string, data: any): void {
    console.log(`   ${label}:`);
    console.log(
      JSON.stringify(
        data,
        (_, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      )
        .split("\n")
        .map((line) => `     ${line}`)
        .join("\n"),
    );
  }

  /**
   * Log separator for visual clarity
   */
  separator(): void {
    console.log("\n" + "─".repeat(80) + "\n");
  }

  /**
   * Log demo header
   */
  header(title: string, description: string): void {
    console.log("\n" + "═".repeat(80));
    console.log(`  ${title}`);
    console.log("═".repeat(80));
    console.log(`  ${description}`);
    console.log("═".repeat(80) + "\n");
  }

  /**
   * Log demo completion
   */
  complete(summary: string): void {
    this.separator();
    console.log(` Demo Complete: ${summary}`);
    this.separator();
  }
}

/**
 * Create a new logger instance for a demo
 */
export function createLogger(): Logger {
  return new Logger();
}
