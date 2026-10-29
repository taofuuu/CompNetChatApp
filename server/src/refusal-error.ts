/** A request refused for a reason the Client may see, such as a taken username. Any other error stays on the server. */
export class RefusalError extends Error {
  override name = 'RefusalError';
}
