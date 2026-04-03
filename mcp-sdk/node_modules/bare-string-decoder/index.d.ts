import Buffer, { type BufferEncoding } from 'bare-buffer'

export class StringDecoder {
  constructor(encoding: BufferEncoding)

  write(buffer: string | Buffer): string

  end(buffer: string | Buffer): string
}
