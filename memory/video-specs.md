---
name: video-specs
description: Especificaciones técnicas reales del video que graba FirstRow VR
metadata:
  type: project
---

El video de FirstRow VR es **estereoscópico 180°**, con resolución **máxima 8K en total** (NO 8K por ojo) y **audio ambisónico 3D**. Compatible con Meta Quest 2, Meta Quest 3/3S, Apple Vision Pro y Pico 4 Ultra.

**Why:** El sitio originalmente decía "8K por ojo" en todas partes, lo que implicaría 16K total y era una sobre-promesa. El usuario confirmó que es 8K total.

**How to apply:** Nunca escribir "8K/6K/4K por ojo" ni "per eye". Usar "hasta 8K", "Resolución 8K máxima", "up to 8K". Las claves de resolución viven en index.html, servicios.html, suscripciones.html, catalogo.html, video.html (tanto en HTML estático como en los diccionarios i18n `es`/`en`).
