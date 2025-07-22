# Usar Node.js 18 Alpine para imagen más ligera
FROM node:18-alpine

# Instalar dependencias del sistema necesarias
RUN apk add --no-cache curl

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar TODAS las dependencias (necesarias para build)
RUN npm ci && npm cache clean --force

# Copiar código fuente
COPY . .

# Construir la aplicación
RUN npm run build

# Instalar solo dependencias de producción
RUN npm ci --only=production && npm cache clean --force

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

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:5015/health || exit 1

# Comando para iniciar la aplicación
CMD ["node", "dist/main"] 