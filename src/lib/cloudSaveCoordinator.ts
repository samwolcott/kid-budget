export interface ConfirmedSaveOptions<State, ServerResult> {
  target: State;
  confirmedState: State;
  write: () => Promise<void>;
  readConfirmed: () => Promise<ServerResult>;
  stateFromResult: (result: ServerResult) => State;
  replace: (target: State, source: State) => void;
}

export async function runConfirmedSave<State, ServerResult>(
  options: ConfirmedSaveOptions<State, ServerResult>,
): Promise<ServerResult> {
  try {
    await options.write();
    const confirmed = await options.readConfirmed();
    options.replace(options.target, options.stateFromResult(confirmed));
    return confirmed;
  } catch (error) {
    options.replace(options.target, options.confirmedState);
    throw error;
  }
}
