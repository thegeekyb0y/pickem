const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_WIDTH = 2400;
const MAX_HEIGHT = 1600;
const MAX_PIXELS = 50_000_000;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function prepareQuizCover(file: File): Promise<File> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size === 0 || file.size > MAX_SOURCE_BYTES) {
    throw new Error("Keep the original image under 12 MB.");
  }

  let bitmap: ImageBitmap | null = null;
  let imageUrl: string | null = null;
  let image: HTMLImageElement | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
    } else {
      imageUrl = URL.createObjectURL(file);
      image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("This image could not be opened."));
        element.src = imageUrl!;
      });
    }

    const width = bitmap?.width ?? image?.naturalWidth ?? 0;
    const height = bitmap?.height ?? image?.naturalHeight ?? 0;
    if (!width || !height || width * height > MAX_PIXELS) {
      throw new Error("Choose an image with fewer than 50 megapixels.");
    }
    const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not process the image.");
    if (bitmap) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    else if (image) context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const webp = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("This browser could not convert the image to WebP.")),
        "image/webp",
        0.82,
      );
    });
    if (webp.size > MAX_OUTPUT_BYTES) {
      throw new Error("The processed cover is too large. Choose a smaller image.");
    }
    return new File([webp], "quiz-cover.webp", {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } finally {
    bitmap?.close();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
}
