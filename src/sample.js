'use strict';

// A sample café menu so a fresh install looks alive in one click.
// The structure (emoji, sizes, prices) is shared; text is per language.
// Prices are in "English" units and scaled per language to fit common local currencies.

const ITEMS = [
  // [category index, key, emoji, base price or sizes [[sizeKey, price]], featured, available]
  [0, 'espresso', '☕', [['single', 3], ['double', 4]]],
  [0, 'latte', '🥛', [['regular', 4.5], ['large', 5.5]], true],
  [0, 'spanish', '🍯', 5.5, true],
  [0, 'iced', '🧋', 6],
  [1, 'croissant', '🥐', 3.5],
  [1, 'cookie', '🍪', 2.5],
  [1, 'cheesecake', '🍰', 5, false, false],
  [2, 'lemonade', '🍋', 3.5],
  [2, 'water', '💧', 1],
];

// factor: price multiplier, step: rounding step for that currency
const TEXT = {
  en: {
    factor: 1, step: 0.5,
    tagline: 'Specialty coffee & fresh bakes every day ☕',
    about: 'A small shop with a big heart. We roast our own beans and bake every morning.',
    hours: 'Daily 8am – midnight',
    categories: ['Coffee', 'Bakery', 'Cold drinks'],
    sizes: { single: 'Single', double: 'Double', regular: 'Regular', large: 'Large' },
    items: {
      espresso: ['Espresso', 'Ethiopian beans, roasted in-house.'],
      latte: ['Latte', 'Espresso with silky steamed milk.'],
      spanish: ['Spanish Latte', 'Latte with sweetened condensed milk. A crowd favourite!'],
      iced: ['Iced Caramel Macchiato', 'Cold, refreshing, with caramel drizzle.'],
      croissant: ['Butter Croissant', 'Baked fresh every morning.'],
      cookie: ['Chocolate Chip Cookie', 'Soft inside, crispy outside.'],
      cheesecake: ['Cheesecake', 'With berry compote.'],
      lemonade: ['Mint Lemonade', 'Fresh lemons and mint.'],
      water: ['Still Water', ''],
    },
  },
  ar: {
    factor: 13.6, step: 5,
    tagline: 'قهوة مختصة ومخبوزات طازة كل يوم ☕',
    about: 'محل صغير بحب كبير. بنحمّص البن بنفسنا وبنخبز كل يوم الصبح.',
    hours: 'يوميًا من 8 صباحًا لـ 12 بالليل',
    categories: ['قهوة', 'مخبوزات', 'مشروبات باردة'],
    sizes: { single: 'سنجل', double: 'دبل', regular: 'وسط', large: 'كبير' },
    items: {
      espresso: ['إسبريسو', 'شوت مزدوج من بن إثيوبي محمّص عندنا.'],
      latte: ['لاتيه', 'إسبريسو مع لبن مبخّر ورغوة ناعمة.'],
      spanish: ['سبانش لاتيه', 'لاتيه بالحليب المكثّف المحلّى. الأكثر طلبًا!'],
      iced: ['آيس كراميل ماكياتو', 'ساقع ومنعش مع صوص كراميل.'],
      croissant: ['كرواسون زبدة', 'مخبوز طازة كل يوم الصبح.'],
      cookie: ['كوكيز شوكولاتة', 'طرية من جوه ومقرمشة من برّه.'],
      cheesecake: ['تشيز كيك', 'بصوص التوت.'],
      lemonade: ['ليموناضة نعناع', 'ليمون فريش ونعناع.'],
      water: ['مياه معدنية', ''],
    },
  },
  es: {
    factor: 18, step: 5,
    tagline: 'Café de especialidad y panadería recién hecha cada día ☕',
    about: 'Un local pequeño con un gran corazón. Tostamos nuestro propio café y horneamos cada mañana.',
    hours: 'Todos los días de 8:00 a 24:00',
    categories: ['Café', 'Panadería', 'Bebidas frías'],
    sizes: { single: 'Sencillo', double: 'Doble', regular: 'Mediano', large: 'Grande' },
    items: {
      espresso: ['Espresso', 'Grano etíope tostado en casa.'],
      latte: ['Latte', 'Espresso con leche vaporizada y sedosa.'],
      spanish: ['Latte español', 'Latte con leche condensada. ¡El favorito!'],
      iced: ['Caramel macchiato helado', 'Frío y refrescante, con caramelo.'],
      croissant: ['Croissant de mantequilla', 'Horneado cada mañana.'],
      cookie: ['Galleta con chispas de chocolate', 'Suave por dentro, crujiente por fuera.'],
      cheesecake: ['Pay de queso', 'Con salsa de frutos rojos.'],
      lemonade: ['Limonada con menta', 'Limones frescos y menta.'],
      water: ['Agua natural', ''],
    },
  },
  pt: {
    factor: 5, step: 0.5,
    tagline: 'Cafés especiais e fornadas frescas todos os dias ☕',
    about: 'Uma loja pequena com um grande coração. Torramos nosso próprio café e assamos toda manhã.',
    hours: 'Todos os dias, das 8h à meia-noite',
    categories: ['Cafés', 'Padaria', 'Bebidas geladas'],
    sizes: { single: 'Simples', double: 'Duplo', regular: 'Médio', large: 'Grande' },
    items: {
      espresso: ['Espresso', 'Grãos etíopes torrados na casa.'],
      latte: ['Latte', 'Espresso com leite vaporizado e cremoso.'],
      spanish: ['Latte espanhol', 'Latte com leite condensado. O favorito da casa!'],
      iced: ['Caramel macchiato gelado', 'Gelado e refrescante, com calda de caramelo.'],
      croissant: ['Croissant de manteiga', 'Assado fresquinho toda manhã.'],
      cookie: ['Cookie de chocolate', 'Macio por dentro, crocante por fora.'],
      cheesecake: ['Cheesecake', 'Com calda de frutas vermelhas.'],
      lemonade: ['Limonada com hortelã', 'Limões frescos e hortelã.'],
      water: ['Água sem gás', ''],
    },
  },
  fr: {
    factor: 1, step: 0.5,
    tagline: 'Café de spécialité et viennoiseries fraîches chaque jour ☕',
    about: 'Une petite boutique avec un grand cœur. Nous torréfions notre café et cuisons chaque matin.',
    hours: 'Tous les jours de 8 h à minuit',
    categories: ['Cafés', 'Boulangerie', 'Boissons fraîches'],
    sizes: { single: 'Simple', double: 'Double', regular: 'Normal', large: 'Grand' },
    items: {
      espresso: ['Espresso', 'Grains éthiopiens torréfiés sur place.'],
      latte: ['Latte', 'Espresso et lait vapeur onctueux.'],
      spanish: ['Latte espagnol', 'Latte au lait concentré sucré. Le préféré des clients !'],
      iced: ['Caramel macchiato glacé', 'Frais, avec un filet de caramel.'],
      croissant: ['Croissant au beurre', 'Cuit chaque matin.'],
      cookie: ['Cookie aux pépites de chocolat', 'Moelleux dedans, croustillant dehors.'],
      cheesecake: ['Cheesecake', 'Coulis de fruits rouges.'],
      lemonade: ['Citronnade à la menthe', 'Citrons frais et menthe.'],
      water: ['Eau plate', ''],
    },
  },
  tr: {
    factor: 30, step: 5,
    tagline: 'Her gün nitelikli kahve ve taze fırın ürünleri ☕',
    about: 'Küçük bir dükkân, büyük bir kalp. Kahvemizi kendimiz kavuruyor, her sabah fırınlıyoruz.',
    hours: 'Her gün 08:00 – 24:00',
    categories: ['Kahve', 'Fırın', 'Soğuk içecekler'],
    sizes: { single: 'Tek', double: 'Duble', regular: 'Orta', large: 'Büyük' },
    items: {
      espresso: ['Espresso', 'Kendi kavurduğumuz Etiyopya çekirdekleri.'],
      latte: ['Latte', 'Espresso ve ipeksi buharlı süt.'],
      spanish: ['İspanyol latte', 'Şekerli yoğunlaştırılmış sütlü latte. En sevilen!'],
      iced: ['Buzlu karamel macchiato', 'Soğuk, ferahlatıcı, karamel soslu.'],
      croissant: ['Tereyağlı kruvasan', 'Her sabah taze pişer.'],
      cookie: ['Çikolatalı kurabiye', 'İçi yumuşak, dışı çıtır.'],
      cheesecake: ['Cheesecake', 'Orman meyveli soslu.'],
      lemonade: ['Naneli limonata', 'Taze limon ve nane.'],
      water: ['Su', ''],
    },
  },
  id: {
    factor: 6000, step: 1000,
    tagline: 'Kopi spesialti & roti segar setiap hari ☕',
    about: 'Toko kecil dengan hati yang besar. Kami menyangrai kopi sendiri dan memanggang setiap pagi.',
    hours: 'Setiap hari 08.00 – 24.00',
    categories: ['Kopi', 'Roti & kue', 'Minuman dingin'],
    sizes: { single: 'Single', double: 'Double', regular: 'Reguler', large: 'Besar' },
    items: {
      espresso: ['Espresso', 'Biji Etiopia, disangrai sendiri.'],
      latte: ['Latte', 'Espresso dengan susu steam yang lembut.'],
      spanish: ['Kopi susu gula aren', 'Favorit pelanggan!'],
      iced: ['Es karamel macchiato', 'Dingin dan segar, dengan saus karamel.'],
      croissant: ['Croissant mentega', 'Dipanggang segar setiap pagi.'],
      cookie: ['Kue cokelat chip', 'Lembut di dalam, renyah di luar.'],
      cheesecake: ['Cheesecake', 'Dengan saus beri.'],
      lemonade: ['Es lemon mint', 'Lemon segar dan daun mint.'],
      water: ['Air mineral', ''],
    },
  },
  hi: {
    factor: 40, step: 10,
    tagline: 'हर दिन स्पेशल कॉफ़ी और ताज़ा बेकरी ☕',
    about: 'छोटी दुकान, बड़ा दिल। हम अपनी कॉफ़ी खुद रोस्ट करते हैं और हर सुबह बेक करते हैं।',
    hours: 'रोज़ सुबह 8 बजे से रात 12 बजे तक',
    categories: ['कॉफ़ी', 'बेकरी', 'ठंडे पेय'],
    sizes: { single: 'सिंगल', double: 'डबल', regular: 'रेगुलर', large: 'लार्ज' },
    items: {
      espresso: ['एस्प्रेसो', 'इथियोपियन बीन्स, हमारे यहाँ रोस्ट किए हुए।'],
      latte: ['लाते', 'एस्प्रेसो और मुलायम भाप वाला दूध।'],
      spanish: ['स्पैनिश लाते', 'कंडेंस्ड मिल्क वाला लाते। सबका पसंदीदा!'],
      iced: ['आइस्ड कैरेमल मैकियाटो', 'ठंडा और ताज़गी भरा, कैरेमल के साथ।'],
      croissant: ['बटर क्रोसां', 'हर सुबह ताज़ा बेक किया हुआ।'],
      cookie: ['चॉकलेट चिप कुकी', 'अंदर से नरम, बाहर से कुरकुरी।'],
      cheesecake: ['चीज़केक', 'बेरी सॉस के साथ।'],
      lemonade: ['पुदीना नींबू पानी', 'ताज़ा नींबू और पुदीना।'],
      water: ['पानी', ''],
    },
  },
};

const scale = (price, { factor, step }) => Math.max(step, Math.round((price * factor) / step) * step);

function loadSample(store, lang) {
  const text = TEXT[lang] || TEXT.en;
  store.updateSettings({
    tagline: store.settings.tagline || text.tagline,
    about: store.settings.about || text.about,
    hours: store.settings.hours || text.hours,
  });
  const cats = text.categories.map((name) => store.addCategory({ name }));
  for (const [catIdx, key, emoji, priceOrSizes, featured = false, available = true] of ITEMS) {
    const [name, description] = text.items[key];
    const variants = Array.isArray(priceOrSizes)
      ? priceOrSizes.map(([sizeKey, price]) => ({ name: text.sizes[sizeKey], price: scale(price, text) }))
      : [];
    store.addProduct(
      {
        categoryId: cats[catIdx].id,
        name,
        description,
        price: variants.length ? variants[0].price : scale(priceOrSizes, text),
        comparePrice: 0,
        image: '',
        emoji,
        available,
        featured,
        variants,
      },
      { save: false }
    );
  }
  store.save();
}

module.exports = { loadSample, SAMPLE_LANGS: Object.keys(TEXT) };
