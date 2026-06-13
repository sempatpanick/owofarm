import sharp from 'sharp';
import { ENCODED_IMAGE_DICT } from './encodedImageDict';

const PRIORITY_GROUPS = [
  'abdegkmpqstvwxyz'.split(''),
  'fho'.split(''),
  'cnru'.split(''),
  'jl'.split(''),
  'i'.split(''),
];

interface ImageBuffer {
  data: Uint8Array;
  width: number;
  height: number;
}

interface LetterMatch {
  x: number;
  y: number;
  letter: string;
  width: number;
  height: number;
}

async function decodeBase64ToImage(b64: string): Promise<ImageBuffer> {
  const { data, info } = await sharp(Buffer.from(b64, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data: new Uint8Array(data),
    width: info.width,
    height: info.height,
  };
}

function pixelsMatch(large: ImageBuffer, small: ImageBuffer, x: number, y: number): boolean {
  for (let sy = 0; sy < small.height; sy++) {
    for (let sx = 0; sx < small.width; sx++) {
      const smallIdx = (sy * small.width + sx) * 4;
      if (small.data[smallIdx + 3] === 0) {
        continue;
      }

      const largeIdx = ((y + sy) * large.width + (x + sx)) * 4;

      if (
        large.data[largeIdx] !== small.data[smallIdx] ||
        large.data[largeIdx + 1] !== small.data[smallIdx + 1] ||
        large.data[largeIdx + 2] !== small.data[smallIdx + 2] ||
        large.data[largeIdx + 3] !== small.data[smallIdx + 3]
      ) {
        return false;
      }
    }
  }

  return true;
}

function overlapsExisting(
  matches: LetterMatch[],
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  return matches.some(
    (match) =>
      match.x - width < x &&
      x < match.x + width &&
      match.y - height < y &&
      y < match.y + height
  );
}

export async function solveHbCaptcha(
  captchaUrl: string,
  session: { get(url: string): Promise<Response> }
): Promise<string> {
  const checks: Array<{ image: ImageBuffer; letter: string }> = [];

  for (const group of PRIORITY_GROUPS) {
    for (const letter of group) {
      const image = await decodeBase64ToImage(ENCODED_IMAGE_DICT[letter]);
      checks.push({ image, letter });
    }
  }

  let large: ImageBuffer;

  try {
    const response = await session.get(captchaUrl);
    const contentType = response.headers.get('Content-Type') ?? '';

    if (!response.ok || !contentType.includes('image')) {
      console.error('Failed to fetch a valid image.');
      return '';
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const { data, info } = await sharp(Buffer.from(bytes))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    large = {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    console.error(`Error fetching the captcha image: ${error}`);
    return '';
  }

  const matches: LetterMatch[] = [];

  for (const { image: small, letter } of checks) {
    for (let y = 0; y <= large.height - small.height; y++) {
      for (let x = 0; x <= large.width - small.width; x++) {
        if (!pixelsMatch(large, small, x, y)) {
          continue;
        }

        if (overlapsExisting(matches, x, y, small.width, small.height)) {
          continue;
        }

        matches.push({
          x,
          y,
          letter,
          width: small.width,
          height: small.height,
        });
      }
    }
  }

  matches.sort((a, b) => a.x - b.x);
  return matches.map((match) => match.letter).join('');
}
