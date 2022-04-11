import { Response } from 'node-fetch';

export class APIError extends Error {
  response: Response;

  constructor(response: Response, message?: string) {
    if (message) {
      super(message);
    } else {
      super(`${response.status} ${response.statusText}`);
    }

    this.name = this.constructor.name;
    this.response = response;
  }

  static async fromResponse(response: Response) {
    let message;

    try {
      let errorData = await response.json() as any;
      if (errorData.apiVersion === 'v1' && errorData.kind === 'Status') {
        message = errorData.message;
      }
    } catch (err) {
    }

    return new APIError(response, message);
  }
}
