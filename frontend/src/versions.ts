// Historial de versiones de la plataforma (la más reciente primero).
// Al publicar cambios: añade una entrada arriba y sube APP_VERSION en backend/app/config.py.

export interface Version {
  version: string;
  date: string; // AAAA-MM-DD
  title: string;
  changes: string[];
}

export const VERSIONS: Version[] = [
  {
    version: "0.22.0",
    date: "2026-10-12",
    title: "the Master Plan",
    changes: [
      "La web se llama the Master Plan y tiene logo propio: una doble R (también como icono de la pestaña).",
      "Publicada en GitHub Pages, con una política de seguridad que solo permite conectar con Supabase.",
    ],
  },
  {
    version: "0.21.0",
    date: "2026-10-12",
    title: "La web entera en la nube, cifrada",
    changes: [
      "La web completa funciona sobre Supabase: los datos se descifran solo en tu navegador y cada cambio se guarda cifrado.",
      "Entrada con correo, contraseña, segundo factor y frase secreta; botón Bloquear para olvidar la clave en este navegador.",
      "Lo que antes calculaba el servidor (resúmenes, Revisar, Coche, Ahorro, búsquedas) se calcula en el navegador con el mismo resultado.",
      "Los Excel del banco y las facturas en PDF se leen en el navegador, igual que antes.",
      "Si la otra persona cambia algo, sale un aviso para actualizar; si los dos cambiáis lo mismo a la vez, no se pisa.",
      "La copia de seguridad incluye también los avisos descartados, las categorías aprendidas del banco y el orden de las pestañas.",
    ],
  },
  {
    version: "0.20.0",
    date: "2026-10-11",
    title: "Actividad, pestañas a tu gusto y orden por dentro",
    changes: [
      "Nueva pestaña Actividad: registro de movimientos con quién cambió qué y cuándo (altas, ediciones, borrados, importaciones, etiquetas) y los inicios de sesión, también los fallidos.",
      "Las pestañas se reordenan arrastrándolas (o en Ajustes); cada usuario guarda su orden.",
      "Subir PDF e Importar Excel se juntan en la pestaña Importar; Versiones pasa a Ajustes.",
      "Gastos usa todo el ancho, con las etiquetas pegadas a la izquierda y los filtros en una línea; el buscador espera a que termines de escribir.",
      "Por dentro: las reglas de clasificación están en un solo archivo (backend/app/rules.py) y se ha quitado código repetido.",
    ],
  },
  {
    version: "0.19.0",
    date: "2026-10-11",
    title: "Gráfica de los gastos elegidos",
    changes: [
      "En Gastos, el botón «Gráfica» analiza la lista filtrada (por ejemplo, la etiqueta Vacaciones 2026): total, número de gastos, periodo y en qué se reparte, por categoría, concepto, etiqueta o mes.",
      "Casillas para marcar gastos sueltos: la gráfica y las etiquetas en bloque se aplican solo a los marcados.",
    ],
  },
  {
    version: "0.18.0",
    date: "2026-10-11",
    title: "Pestaña Revisar",
    changes: [
      "Nueva pestaña Revisar con todo lo pendiente: gastos marcados, posibles duplicados, facturas que faltan o se solapan, ingresos dudosos, importes raros, gastos sin categoría o grandes en «Otros», coche sin tipo, comercios en varias categorías y PDF sin gasto.",
      "Cada aviso lleva a sus gastos y se puede descartar (y volver a mostrar). La pestaña muestra cuántos quedan.",
    ],
  },
  {
    version: "0.17.0",
    date: "2026-10-11",
    title: "El tipo de gasto del coche es una etiqueta",
    changes: [
      "Gasolina, Peajes, Aparcamiento, Reparaciones y mantenimiento y Seguro son etiquetas: se corrigen arrastrando la buena al gasto, y sustituye a la anterior.",
      "Los gastos sin etiqueta toman el tipo de otro gasto del mismo comercio; si no, se deduce del concepto.",
      "Machupichu, Albasanz y Ciutadella pasan a Gasolina.",
    ],
  },
  {
    version: "0.16.0",
    date: "2026-10-11",
    title: "De la barra a sus gastos",
    changes: [
      "Al pulsar una barra de los gráficos (Resumen, Coche, Comparar y Ahorro) se abre Gastos con los gastos que la forman: esa categoría o tipo del coche, en ese año o mes.",
      "Gastos filtra por tipo de gasto del coche y por «Sin categoría».",
    ],
  },
  {
    version: "0.15.1",
    date: "2026-10-11",
    title: "Selección de tipos en los gráficos del coche",
    changes: [
      "En Coche, los gráficos por año y mes a mes tienen casillas para marcar o desmarcar tipos (gasolina, reparaciones, seguro…); la selección se recuerda.",
    ],
  },
  {
    version: "0.15.0",
    date: "2026-10-11",
    title: "Panel de etiquetas con arrastrar y soltar",
    changes: [
      "En Gastos, panel de etiquetas a la izquierda: se buscan, se crean y, con un clic, filtran la lista.",
      "Arrastrar una etiqueta del panel a un gasto se la pone; arrastrarla desde un gasto hacia fuera (o al panel) se la quita, y a otro gasto la mueve.",
      "El buscador de Gastos también busca en las etiquetas: «!taxi» quita los gastos con la etiqueta Taxi.",
    ],
  },
  {
    version: "0.14.1",
    date: "2026-10-11",
    title: "Excluir palabras al buscar",
    changes: [
      "En Gastos, una palabra con ! delante excluye los gastos que la contienen: «!mercadona !condis».",
    ],
  },
  {
    version: "0.14.0",
    date: "2026-10-11",
    title: "Etiquetas y categoría para gastos iguales",
    changes: [
      "Etiquetas libres (por ejemplo «Trenes» o «Blablacar»): se crean en Ajustes o al escribirlas en la ficha de un gasto, y un gasto puede llevar varias.",
      "En Gastos se filtra por etiqueta y se puede poner o quitar una etiqueta a toda la lista filtrada de una vez.",
      "Al cambiar la categoría de un gasto, cambia también en los gastos del mismo comercio que tenían la misma categoría (se puede desmarcar), y las próximas importaciones del banco lo recuerdan.",
    ],
  },
  {
    version: "0.13.0",
    date: "2026-10-11",
    title: "Marcar gastos para revisar",
    changes: [
      "Cualquier gasto se puede marcar para revisar con el botón ⚑ de la lista o en su ficha; aparece en «Pendientes de revisar».",
      "Los PDF archivados y los Excel de In/ tienen nombres legibles (categoría, periodo, proveedor e importe).",
    ],
  },
  {
    version: "0.12.0",
    date: "2026-10-11",
    title: "Ahorro desde 2025",
    changes: [
      "La pestaña Ahorro cuenta ingresos y gastos solo desde 2025.",
      "Ingresos de 2025 importados del Excel del banco.",
    ],
  },
  {
    version: "0.11.0",
    date: "2026-10-11",
    title: "Ingresos y ahorro",
    changes: [
      "Los ingresos de la cuenta (aportaciones mensuales, transferencias recibidas, efectivo, Bizum) se importan del Excel como ingresos de la unidad familiar.",
      "Nueva pestaña Ahorro: ingresos, gastos, ahorro y tasa de ahorro por mes y por año, con conclusiones.",
      "Alta manual de ingresos (por ejemplo, nóminas que no pasan por la cuenta).",
      "El historial de importaciones también deshace los ingresos.",
    ],
  },
  {
    version: "0.10.0",
    date: "2026-10-11",
    title: "Apartado del coche",
    changes: [
      "Nueva categoría y pestaña Coche: gasolina, reparaciones y mantenimiento, seguro, peajes y aparcamiento, por año y mes.",
      "Las gasolineras, talleres, peajes y parkings que estaban en Transporte pasan a Coche (y así se importarán).",
      "Seguro del coche de 2026 (507,92 €).",
      "Gastos: filtro de importe mínimo y máximo.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-10-11",
    title: "Comparar años y conclusiones",
    changes: [
      "Nueva pestaña Comparar: categorías y conceptos por año, con diferencias y peso de cada partida.",
      "Conclusiones automáticas: nivel de gasto, principales partidas, lo que crece, baja o se mantiene, fijos frente a variables.",
      "Si el último año está a medias se comparan los mismos meses de cada año.",
      "Limpieza de recibos del banco que duplicaban facturas PDF y del alquiler de 2026.",
      "Un movimiento solo se toma por duplicado si además coincide la categoría o el comercio.",
      "Revisión de anomalías: recibos de DIGI duplicados, trenes y Blablacar en Viajes, periodos de internet alineados.",
      "Gastos: búsqueda por palabras, rango de fechas, importe mínimo y máximo, y origen de cada gasto (PDF, banco o manual).",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-10-11",
    title: "Deshacer importaciones",
    changes: [
      "Historial de importaciones en Importar Excel: se puede deshacer una sesión entera o solo un bloque (p. ej. «importar todos»).",
      "Alquiler de 2022 a 2026 dado de alta mes a mes.",
      "Los recibos «alquiler seguro, s.a.u.» (con coma) se reconocen como Alquiler.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-10-11",
    title: "Cotejo con el banco, alquiler y versiones",
    changes: [
      "Cotejo de los recibos del banco con las facturas: los que cuadran, los que tienen otro importe y las facturas sin cargo en el banco.",
      "Los recibos sin factura que caen en un hueco lo rellenan: al importarlos cubren ese periodo.",
      "Al cambiar la categoría de un movimiento se cambia en todos los del mismo comercio, y se recuerda para próximas importaciones.",
      "Botón OK para importar un movimiento suelto y selección múltiple para importar varios a la vez.",
      "Filtros por tipo, categoría, cotejo y palabras en la importación de Excel.",
      "Nueva categoría Alquiler.",
      "Las facturas que faltan se ven en el timeline (también las de agua, comunidad o alquiler); se quita la lista bajo el gráfico mensual.",
      "Pestaña Versiones.",
      "Las casillas de categorías también filtran el gráfico «Gasto mensual» (la selección es la misma en los dos gráficos).",
      "Se quitan las marcas «! n» de facturas que faltan del gráfico mensual: los huecos se ven en el timeline.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-10-11",
    title: "Movimientos del banco desde Excel",
    changes: [
      "Nueva página Importar Excel para los movimientos del banco (BBVA «Últimos movimientos»).",
      "Antes de importar se descartan tipos de movimiento: traspasos, transferencias, efectivo e ingresos.",
      "Los movimientos que ya están registrados desde un PDF vienen desmarcados y no se duplican.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-10-11",
    title: "Periodos cubiertos",
    changes: [
      "Timeline en Resumen con los días que cubre cada factura y enlace a su PDF.",
      "Casillas para marcar o desmarcar categorías en «Gasto por año».",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-10-11",
    title: "Facturas que faltan más precisas",
    changes: [
      "Las facturas bimestrales cubren sus dos meses: los huecos se calculan con el periodo de facturación.",
      "Cada aviso indica las fechas sin factura.",
      "Un gasto dado de alta a mano quita el aviso de su mes.",
      "Las facturas de DIGI se leen con IVA (lo que realmente se cobra).",
      "El año elegido en Resumen se recuerda.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-10-11",
    title: "Lectura local, Supabase y copias de seguridad",
    changes: [
      "Las facturas se leen con lectores propios para cada proveedor, sin servicios externos.",
      "Preparada para usar Supabase (PostgreSQL) como base de datos.",
      "Exportar e importar copias de seguridad con los datos y los PDF.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-10-10",
    title: "Carpeta de entrada y facturas que faltan",
    changes: [
      "Carpeta in/ para facturas nuevas: se clasifican y se eliminan las copias.",
      "El gráfico mensual marca las facturas que faltan.",
      "Al revisar un gasto se ve su PDF.",
      "Tonos pastel en toda la web.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-10",
    title: "Primera versión",
    changes: [
      "Subida de facturas en PDF y gastos manuales.",
      "Gráficas de gasto por año y por mes.",
      "Acceso con usuario y contraseña.",
    ],
  },
];

export const APP_VERSION = VERSIONS[0].version;
