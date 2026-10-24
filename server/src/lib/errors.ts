/** An error whose message is safe to show the user, with the HTTP status to send. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = "HttpError";
  }
}
