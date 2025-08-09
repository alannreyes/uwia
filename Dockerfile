# Usar Node.js 18 Alpine para imagen más ligera
FROM node:18-alpine

# Instalar dependencias del sistema necesarias
RUN apk add --no-cache curl ghostscript graphicsmagick

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

# Instalar solo dependencias de producción
RUN npm install --only=production && npm cache clean --force

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