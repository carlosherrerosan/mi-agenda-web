# Mi Agenda · Versión web de prueba

Aplicación web estática instalable desde Safari. Diseño marfil y arena, tareas personales y laborales, centros, calendario mensual y copia de seguridad. Sin servicios de pago ni dependencias de terceros.

## Privacidad

**El repositorio no contiene tareas, cumpleaños, nombres de centros ni copias de seguridad.** Los datos se almacenan únicamente en el navegador de cada dispositivo mediante `localStorage`. No se envían a GitHub ni a un servidor. Al borrar los datos del navegador o cambiar de dispositivo se pueden perder: exporta copias periódicas desde Ajustes.

## Diferencias importantes respecto a Expo Go

- Esta versión web **NO programa notificaciones locales con la app cerrada**. Mantén la versión de Expo Go para los avisos que ya funcionan.
- No sincroniza automáticamente los datos de Expo Go. Importa la copia de seguridad guardada previamente (archivo `.txt` o `.json` con el JSON completo) desde **Ajustes → Importar copia de Expo Go**.
- Los cambios hechos en una versión no aparecerán en la otra salvo que exportes e importes una nueva copia.
- La instalación como icono requiere abrir la página publicada en Safari → Compartir → Añadir a pantalla de inicio.

## Publicación gratis con GitHub Pages

1. Crea **un repositorio nuevo y público**, separado de otros proyectos, por ejemplo `mi-agenda-web`.
2. Sube el **contenido de esta carpeta** a la raíz de la rama `main`. No subas copias de seguridad ni archivos personales.
3. En el repositorio abre **Settings → Pages → Build and deployment → Deploy from a branch**, selecciona `main` y `/ (root)`, y guarda.
4. Cuando GitHub muestre la dirección HTTPS, ábrela en Safari. La aplicación se puede añadir a pantalla de inicio.

GitHub Pages sirve los archivos públicos del código. **Nunca** subas tu copia de seguridad al repositorio.

## Comprobaciones locales

- `npm test` ejecuta pruebas de formato de copias, calendario y dictado.
- Para probar en un navegador: `python -m http.server 8080` y abrir `http://localhost:8080`.
- El modo sin conexión requiere HTTPS (como GitHub Pages) y una primera visita en línea.

## Origen del código

La lógica de fechas, calendarios y validación de copias procede del proyecto Expo de Mi Agenda. La interfaz web es una adaptación nueva para navegadores. No se ha incorporado el listado privado de centros.
