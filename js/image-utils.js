export const DEFAULT_IMAGE = new URL('../img/la-pana-del-bajo.jpg', import.meta.url).href;

function normalizeImageUrl(value) {
    const image = String(value ?? '').trim();
    if (!image) return DEFAULT_IMAGE;
    if (/^(https?:\/\/|blob:|data:image\/)/i.test(image)) return image;

    const compact = image.replace(/\s/g, '');
    if (compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
        const mimeType = compact.startsWith('iVBORw0KGgo') ? 'image/png'
            : compact.startsWith('/9j/') ? 'image/jpeg'
                : compact.startsWith('R0lGOD') ? 'image/gif'
                    : compact.startsWith('UklGR') ? 'image/webp'
                        : 'image/jpeg';
        return `data:${mimeType};base64,${compact}`;
    }

    return new URL(image, document.baseURI).href;
}

export function setProductImage(imageElement, ...sources) {
    const source = sources.find(value => String(value ?? '').trim());
    imageElement.onerror = () => {
        imageElement.onerror = null;
        imageElement.src = DEFAULT_IMAGE;
    };
    imageElement.src = normalizeImageUrl(source);
}
