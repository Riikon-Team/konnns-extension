/**
 * Handles animated GIF / WebP decoding and frame retrieval for both preview and export.
 * Uses the WebCodecs ImageDecoder API (standard in modern Chromium & Firefox).
 */

export interface AnimatedFrame {
  bitmap: ImageBitmap;
  /** presentation timestamp in seconds within the animation loop */
  timestamp: number;
  /** duration of this frame in seconds */
  duration: number;
}

export interface AnimatedImage {
  frames: AnimatedFrame[];
  totalDuration: number;
  width: number;
  height: number;
}

/**
 * Decodes an image Blob. If it's an animated GIF (or animated image) with multiple frames,
 * returns all decoded frames with their respective durations and total loop length.
 * Otherwise returns a single static frame with duration Infinity.
 */
export async function decodeAnimatedImage(blob: Blob): Promise<AnimatedImage> {
  const ImageDecoderClass = (globalThis as unknown as { ImageDecoder?: typeof ImageDecoder }).ImageDecoder;

  if (typeof ImageDecoderClass !== "undefined") {
    try {
      const type = blob.type || "image/gif";
      const isSupported = await ImageDecoderClass.isTypeSupported(type).catch(() => false);
      if (isSupported) {
        const buffer = await blob.arrayBuffer();
        const decoder = new ImageDecoderClass({ data: buffer, type });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        const frameCount = track ? track.frameCount : 1;

        if (frameCount > 1) {
          const frames: AnimatedFrame[] = [];
          let currentTimestamp = 0;

          for (let i = 0; i < frameCount; i++) {
            const result = await decoder.decode({ frameIndex: i });
            const vf: VideoFrame = result.image;
            const bitmap = await createImageBitmap(vf);
            // duration is in microseconds; fallback to 0.1s (10fps) if zero or missing
            const duration = vf.duration && vf.duration > 0 ? vf.duration / 1e6 : 0.1;
            vf.close();

            frames.push({
              bitmap,
              timestamp: currentTimestamp,
              duration,
            });
            currentTimestamp += duration;
          }

          decoder.close();
          const first = frames[0]!;
          return {
            frames,
            totalDuration: Math.max(0.05, currentTimestamp),
            width: first.bitmap.width,
            height: first.bitmap.height,
          };
        }
        decoder.close();
      }
    } catch {
      // Fallback to static bitmap below if ImageDecoder errors
    }
  }

  const bitmap = await createImageBitmap(blob);
  return {
    frames: [{ bitmap, timestamp: 0, duration: Infinity }],
    totalDuration: 0,
    width: bitmap.width,
    height: bitmap.height,
  };
}

/**
 * Returns the ImageBitmap corresponding to timeInItem (in seconds), looping automatically.
 */
export function frameForTime(image: AnimatedImage, timeInItem: number): ImageBitmap {
  if (image.frames.length <= 1 || image.totalDuration <= 0) {
    return image.frames[0]!.bitmap;
  }

  // Positive modulo for loop time
  const loopTime = ((timeInItem % image.totalDuration) + image.totalDuration) % image.totalDuration;

  for (let i = 0; i < image.frames.length; i++) {
    const frame = image.frames[i]!;
    if (loopTime >= frame.timestamp && loopTime < frame.timestamp + frame.duration) {
      return frame.bitmap;
    }
  }

  return image.frames[image.frames.length - 1]!.bitmap;
}

/**
 * Closes all ImageBitmaps in an AnimatedImage to release GPU/RAM memory.
 */
export function disposeAnimatedImage(image: AnimatedImage): void {
  for (const frame of image.frames) {
    frame.bitmap.close();
  }
}
