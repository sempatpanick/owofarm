import { exec } from 'child_process';

const openUrl = (url: string): Promise<boolean> => {
  const platform = process.platform;
  let command: string;

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  return new Promise((resolve) => {
    exec(command, (error) => resolve(!error));
  });
};

export default openUrl;
