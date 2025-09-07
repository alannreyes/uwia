# Usar Node.js 20 Alpine para compatibilidad con pdf-to-png-converter
# Build version: 2025-08-13-v2 - pdfjs-dist diagnostics
FROM node:20-alpine

# Instalar dependencias del sistema necesarias
# Incluye Python3, Canvas, pdfjs-dist y dependencias de compilación
RUN apk add --no-cache \
    curl \
    ghostscript \
    graphicsmagick \
    python3 \
    py3-pip \
    build-base \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    fontconfig \
    freetype-dev \
    harfbuzz-dev

# Establecer directorio de trabajo
WORKDIR /app

# Cache buster - force rebuild 2025-08-13-16:35
RUN echo "Rebuild timestamp: $(date)" > /tmp/rebuild.txt

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar TODAS las dependencias (necesarias para build)
RUN npm install --production=false && npm cache clean --force

# Copiar código fuente
COPY . .

# Construir la aplicación
RUN npm run build

# Limpiar devDependencies pero mantener las de producción
RUN npm prune --production && npm cache clean --force

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Cambiar propietario de archivos
RUN chown -R nestjs:nodejs /app
USER nestjs

# Exponer múltiples puertos posibles
# El puerto real se define por la variable PORT en runtime
EXPOSE 5015 5025 5035

# Variables de entorno por defecto
ENV NODE_ENV=production
# PORT se define externamente en EasyPanel/docker-compose

# Comando para iniciar la aplicación
CMD ["node", "dist/src/main.js"] 