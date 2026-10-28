# Calaud · Auditorías clínicas

Prototipo local para diligenciar, consolidar y generar informes de auditoría clínica desde instrumentos Excel compatibles.

## Flujo disponible

1. Carga una de las plantillas compatibles: RCV `R-GCAL101-76` (hojas `DM` y `HTA`) o control prenatal `R-GCAL101-71` (hoja `FORMATO FINAL`).
2. Calaud normaliza el instrumento a secciones, criterios, grupos, marcas y capacidad de muestra. El número de secciones, criterios y consecutivos se adapta al archivo.
3. Completa o corrige cada criterio como `Cumple`, `No cumple` o `N/A`.
4. Consulta la adherencia, el avance por sección y los resultados por estándar o grupo cuando el instrumento los incluye.
5. Genera un informe imprimible o usa **Guardar como PDF** desde el cuadro de impresión.

La adherencia se calcula como `Cumple / (Cumple + No cumple)`; `N/A` se excluye. Las celdas pendientes no entran en el denominador y se muestran como pendientes. El informe queda identificado como borrador y requiere revisión humana.

Cada nueva plantilla requiere un adaptador de lectura que identifique sus hojas, filas de criterios, grupos, columnas de muestra y categorías. La interfaz y el cálculo se comparten entre instrumentos, pero no se debe asumir que cualquier `.xlsx` tiene la misma estructura o regla de adherencia.

## Ejecutar

Requiere Node.js y las dependencias del proyecto instaladas para el sistema operativo actual.

```bash
npm install
npm run dev
```

## Publicar en Render

Configura el servicio como sitio estático, con `npm install && npm run build` como comando de compilación y `build` como directorio de publicación. Vite está configurado para generar allí los archivos de producción.

## Privacidad y límites

- El lector procesa el Excel en el navegador y no llama a Gemini ni envía el archivo a una API.
- Los adaptadores extraen los criterios y las marcas; omiten las filas de identificación de las plantillas soportadas. El avance local guarda marcas y criterios sin identificadores.
- No adjuntes archivos que contengan identificadores si el dispositivo o navegador no está autorizado para tratarlos.
- La lectura clínica del expediente, la selección de la muestra y la aprobación del informe siguen a cargo del equipo auditor.
- El prototipo no se conecta a SAHI, correo ni otra fuente institucional; tampoco autentica usuarios ni cifra el almacenamiento local.
- La app aplica las reglas de conteo del instrumento recibido, pero no valida clínicamente sus umbrales, textos o versión. Requiere validación institucional antes de uso operativo.


