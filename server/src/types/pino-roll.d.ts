// pino-roll ships no type declarations. This covers only the options we use.
declare module 'pino-roll' {
  interface RollingFileStream {
    write(chunk: string): boolean
    end(): void
    flushSync(): void
  }

  interface RollOptions {
    file: string
    frequency?: 'daily' | 'hourly' | number
    extension?: string
    dateFormat?: string
    mkdir?: boolean
    // Sonic-boom option: write synchronously so the last lines survive process.exit().
    sync?: boolean
    limit?: { count?: number; removeOtherLogFiles?: boolean }
  }

  function roll(options: RollOptions): Promise<RollingFileStream>
  export = roll
}
