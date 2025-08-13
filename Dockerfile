# Usar Node.js 20 Alpine para compatibilidad con pdf-to-png-converter
FROM node:20-alpine

# Instalar dependencias del sistema necesarias
# Incluye Python3 y dependencias de compilación para canvas
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
    pixman-dev

# Establecer directorio de trabajo
WORKDIR /app

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

# Exponer el puerto
EXPOSE 5015

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=5015

# Comando para iniciar la aplicación
CMD ["node", "dist/main"] 