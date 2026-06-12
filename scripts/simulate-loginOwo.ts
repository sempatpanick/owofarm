import dotenv from 'dotenv';
import { solveOwoCaptcha } from '../src/tools/loginOwo';

dotenv.config();

const token = process.env.TOKEN?.split(',')[0]?.trim();

if (!token) {
  console.error('No TOKEN in .env');
  process.exit(1);
}

solveOwoCaptcha(token).then((result) => {
  console.log('Result:', result);
  if (result.url) console.log('Manual captcha URL:', result.url);
});
