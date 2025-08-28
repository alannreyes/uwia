# Actualización de Base de Datos - Configuración Real

## Descripción
Este script actualiza la base de datos con la configuración real para los archivos LOP.pdf y POLICY.pdf.

## Cambios incluidos:
1. Agrega campo `pmc_field` a la tabla `document_prompts`
2. Configura 4 prompts para LOP.pdf
3. Configura 10 prompts para POLICY.pdf

## Cómo ejecutar:

### Opción 1: Desde MySQL cliente
```bash
mysql -h automate_mysql -u mysql -p27d9IyP3Tyg19WUL8a6T axioma < database/scripts/05_update_real_data.sql
```

### Opción 2: Desde phpMyAdmin
1. Abre phpMyAdmin
2. Selecciona la base de datos `axioma`
3. Ve a la pestaña SQL
4. Copia y pega el contenido de `05_update_real_data.sql`
5. Ejecuta

## Verificación
El script incluye SELECT statements al final para verificar que los datos se insertaron correctamente.

## Configuración resultante:

### LOP.pdf (4 campos):
- LOP signed by HO (boolean)
- LOP signed by Client (boolean) 
- LOP Date (date)
- Mechanics Lien (New) (boolean)

### POLICY.pdf (10 campos):
- Matching Insured name (boolean)
- Matching Insurance Company (boolean)
- Policy Valid From (date)
- Policy Valid To (date)
- Policy Number (text)
- Policy Covers Cause of Loss (New) (text)
- Match Address homeowner (text)
- Match Street homeowner (text)
- Match City homeowner (text)
- Match ZIP homeowner (text)
