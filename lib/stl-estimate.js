const AREA = Math.PI * (1.75 / 2) ** 2;

export async function estimateFromStlUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('No se pudo leer el STL generado.');
  const bytes = Buffer.from(await response.arrayBuffer());
  return estimateFromStlBuffer(bytes);
}

export function estimateFromStlBuffer(input) {
  const bytes = Buffer.from(input);
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('El STL generado no es válido o supera 50 MB.');

  const points = [];
  let signedVolume = 0;
  if (bytes.length >= 84 && 84 + bytes.readUInt32LE(80) * 50 === bytes.length) {
    const count = bytes.readUInt32LE(80);
    for (let i = 0, offset = 84; i < count; i++, offset += 50) {
      const tri = [];
      for (let vertex = 0; vertex < 3; vertex++) {
        const start = offset + 12 + vertex * 12;
        tri.push([bytes.readFloatLE(start), bytes.readFloatLE(start + 4), bytes.readFloatLE(start + 8)]);
      }
      const [a, b, c] = tri;
      signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
      points.push(...tri);
    }
  } else {
    const text = bytes.toString('utf8');
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let match, tri = [];
    while ((match = re.exec(text))) {
      const p = [+match[1], +match[2], +match[3]];
      tri.push(p); points.push(p);
      if (tri.length === 3) {
        const [a, b, c] = tri;
        signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        tri = [];
      }
    }
  }
  if (!points.length) throw new Error('El archivo STL no contiene triángulos legibles.');

  let mm3 = Math.abs(signedVolume);
  if (mm3 < 0.01) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of points) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]); }
    mm3 = (max[0] - min[0]) * (max[1] - min[1]) * (max[2] - min[2]) * 0.15;
  }
  const volumeCm3 = mm3 / 1000;
  const filamentM = mm3 * 0.2 / AREA / 1000;
  const timeMinutes = Math.max(8, Math.ceil(volumeCm3 * 1.24 * 1.9));
  return { filament_m: +filamentM.toFixed(2), time_minutes: timeMinutes, volume_cm3: +volumeCm3.toFixed(2) };
}

