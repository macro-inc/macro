import { FileSystemError, UserError } from './error';

export async function verifyHandlePermission(
  handle: FileSystemFileHandle,
  mode: FileSystemPermissionMode
) {
  const permission = await handle.queryPermission({ mode });
  if (permission === 'denied') {
    throw new FileSystemError(
      `Permission to ${mode} is denied to ${handle.name}`
    );
  }
  if (permission === 'prompt') {
    if ((await handle.requestPermission({ mode })) !== 'granted') {
      throw new UserError(`User denied ${mode} permission to ${handle.name}`);
    }
  }
  return handle;
}
