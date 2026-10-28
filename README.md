# Calaud · Auditoría clínica RCV

Prototipo local para diligenciar y consolidar las listas de chequeo de Diabetes mellitus tipo 2 e Hipertensión arterial del instrumento `R-GCAL101-76`.

## Flujo disponible

1. Carga un Excel `.xlsx` que incluya las hojas `DM` y `HTA`.
2. La app lee los criterios y las marcas de las 25 posiciones por programa en el navegador.
3. Completa o corrige cada criterio como `Cumple`, `No cumple` o `N/A`.
4. Consulta la adherencia y el avance en el tablero.
5. Genera un informe imprimible o usa **Guardar como PDF** desde el cuadro de impresión.

La adherencia se calcula como `Cumple / (Cumple + No cumple)`; `N/A` se excluye. Las celdas pendientes no entran en el denominador y se muestran como pendientes. El informe queda identificado como borrador y requiere revisión humana.

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
- No lee ni conserva las celdas de número de historia, profesional o fechas de atención. El avance local guarda marcas y criterios sin identificadores.
- No adjuntes archivos que contengan identificadores si el dispositivo o navegador no está autorizado para tratarlos.
- La lectura clínica del expediente, la selección de la muestra y la aprobación del informe siguen a cargo del equipo auditor.
- El prototipo no se conecta a SAHI, correo ni otra fuente institucional; tampoco autentica usuarios ni cifra el almacenamiento local.
- La app aplica las reglas de conteo del instrumento recibido, pero no valida clínicamente sus umbrales, textos o versión. Requiere validación institucional antes de uso operativo.


