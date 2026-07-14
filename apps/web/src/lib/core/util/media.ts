type Dimensions = { width: number; height: number };

export async function getVideoDimensions(src: string | File) {
  return new Promise<Dimensions>((resolve) => {
    const video = document.createElement('video');

    function onMetadataLoaded(event: Event) {
      const target = event.currentTarget;
      if (target instanceof HTMLVideoElement) {
        resolve({ width: target.videoWidth, height: target.videoHeight });
        return;
      }

      resolve({ width: 0, height: 0 });
    }

    video.addEventListener('loadedmetadata', onMetadataLoaded, {
      capture: false,
      once: true,
    });

    video.addEventListener(
      'error',
      () => {
        video.removeEventListener('loadedmetadata', onMetadataLoaded);
        resolve({ width: 0, height: 0 });
      },
      { capture: false, once: true }
    );

    let url;
    if (src instanceof File) {
      url = URL.createObjectURL(src);
    } else {
      url = src;
    }

    video.src = url;
  });
}

export async function getImageDimensions(src: string | File) {
  return new Promise<Dimensions>((resolve) => {
    const image = new Image();

    function onMetadataLoaded(event: Event) {
      const target = event.currentTarget;
      if (target instanceof HTMLImageElement) {
        resolve({ width: target.naturalWidth, height: target.naturalHeight });
        return;
      }

      resolve({ width: 0, height: 0 });
    }

    image.addEventListener('load', onMetadataLoaded, {
      capture: false,
      once: true,
    });

    image.addEventListener(
      'error',
      () => {
        image.removeEventListener('load', onMetadataLoaded);
        resolve({ width: 0, height: 0 });
      },
      { capture: false, once: true }
    );

    let url;
    if (src instanceof File) {
      url = URL.createObjectURL(src);
    } else {
      url = src;
    }

    image.src = url;
  });
}
