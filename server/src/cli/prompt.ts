import readline from 'node:readline'
import { Writable } from 'node:stream'

/** Reads the first line piped into stdin (used by installers: `echo ... | main init-admin --password-stdin`). */
export async function readLineFromStdin(): Promise<string> {
  const lines = readline.createInterface({ input: process.stdin, terminal: false })
  try {
    for await (const line of lines) return line
    return ''
  } finally {
    lines.close()
  }
}

/** Asks a question on the terminal; when `hidden`, nothing the person types is echoed back. */
export function ask(question: string, hidden = false): Promise<string> {
  let muted = false
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk)
      callback()
    },
  })

  const rl = readline.createInterface({ input: process.stdin, output, terminal: true })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(answer)
    })
    // Mute only after the question text itself has been printed.
    muted = hidden
  })
}
