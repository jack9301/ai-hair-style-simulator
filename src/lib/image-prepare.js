// Preparing a picked image for the AI provider.
//
// Browser-only: this module uses Canvas and the File API. It must never be
// imported by a server module.
//
// The provider takes JPEG and PNG only, and a phone photo is easily several
// megabytes — which would mean megabytes of base64 in every request body and
// in every database row. Decoding and re-encoding in the browser fixes both
// problems at once: the file is always a JPEG, and never bigger than it needs
// to be.

/**
 * Longest edge we keep. Big enough for a face, small enough that the
 * base64 payload stays reasonable.
 */
const MAX_EDGE = 1024;

/** JPEG quality. Above ~0.9 the file gets much bigger for no visible gain. */
const JPEG_QUALITY = 0.92;

/**
 * A JPEG this size or smaller is already good to go, so it is passed
 * through untouched rather than decoded and re-encoded for nothing.
 */
const MAX_PASSTHROUGH_BYTES = 2 * 1024 * 1024;

/** Decode a file into an <img> element. */
function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "This image could not be read. Please upload a JPEG or PNG image."
        )
      );
    };
    img.src = url;
  });
}

/**
 * Turn a picked image into a JPEG small enough to send and acceptable to
 * the provider.
 *
 * Returns a File. Throws with a message worth showing to the user when the
 * browser cannot decode what they picked — a HEIC photo in a browser that
 * does not understand HEIC, for instance.
 */
export async function prepareImageForUpload(file) {
  const type = (file.type || "").toLowerCase();

  if (type === "image/jpeg" && file.size <= MAX_PASSTHROUGH_BYTES) {
    return file;
  }

  const img = await loadImageElement(file);

  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("This image could not be read. Please try a different photo.");
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("This browser cannot prepare the image for upload.");
  }

  // JPEG has no transparency channel. Without this, a PNG with a transparent
  // background comes out with black patches where the transparency was.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) {
    throw new Error("This image could not be converted. Please try a different photo.");
  }

  const name = file.name ? file.name.replace(/\.[^.]+$/, "") : "photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}
