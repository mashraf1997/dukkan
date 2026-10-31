'use strict';

// A sample café menu so a fresh install looks alive in one click.
const SAMPLE = {
  ar: {
    tagline: 'قهوة مختصة ومخبوزات طازة كل يوم ☕',
    about: 'محل صغير بحب كبير. بنحمّص البن بنفسنا وبنخبز كل يوم الصبح.',
    hours: 'يوميًا من 8 صباحًا لـ 12 بالليل',
    categories: [
      {
        name: 'قهوة',
        products: [
          { name: 'إسبريسو', emoji: '☕', description: 'شوت مزدوج من بن إثيوبي محمّص عندنا.', variants: [['سنجل', 35], ['دبل', 50]] },
          { name: 'لاتيه', emoji: '🥛', description: 'إسبريسو مع لبن مبخّر ورغوة ناعمة.', featured: true, variants: [['وسط', 60], ['كبير', 75]] },
          { name: 'سبانش لاتيه', emoji: '🍯', description: 'لاتيه بالحليب المكثّف المحلّى. الأكثر طلبًا!', featured: true, price: 80 },
          { name: 'آيس كراميل ماكياتو', emoji: '🧋', description: 'ساقع ومنعش مع صوص كراميل.', price: 85 },
        ],
      },
      {
        name: 'مخبوزات',
        products: [
          { name: 'كرواسون زبدة', emoji: '🥐', description: 'مخبوز طازة كل يوم الصبح.', price: 45 },
          { name: 'كوكيز شوكولاتة', emoji: '🍪', description: 'طرية من جوه ومقرمشة من برّه.', price: 30 },
          { name: 'تشيز كيك', emoji: '🍰', description: 'بصوص التوت.', price: 70, available: false },
        ],
      },
      {
        name: 'مشروبات باردة',
        products: [
          { name: 'ليموناضة نعناع', emoji: '🍋', description: 'ليمون فريش ونعناع.', price: 40 },
          { name: 'مياه معدنية', emoji: '💧', price: 10 },
        ],
      },
    ],
  },
  en: {
    tagline: 'Specialty coffee & fresh bakes every day ☕',
    about: 'A small shop with a big heart. We roast our own beans and bake every morning.',
    hours: 'Daily 8am – midnight',
    categories: [
      {
        name: 'Coffee',
        products: [
          { name: 'Espresso', emoji: '☕', description: 'Ethiopian beans, roasted in-house.', variants: [['Single', 3], ['Double', 4]] },
          { name: 'Latte', emoji: '🥛', description: 'Espresso with silky steamed milk.', featured: true, variants: [['Regular', 4.5], ['Large', 5.5]] },
          { name: 'Spanish Latte', emoji: '🍯', description: 'Latte with sweetened condensed milk. A crowd favourite!', featured: true, price: 5.5 },
          { name: 'Iced Caramel Macchiato', emoji: '🧋', description: 'Cold, refreshing, with caramel drizzle.', price: 6 },
        ],
      },
      {
        name: 'Bakery',
        products: [
          { name: 'Butter Croissant', emoji: '🥐', description: 'Baked fresh every morning.', price: 3.5 },
          { name: 'Chocolate Chip Cookie', emoji: '🍪', description: 'Soft inside, crispy outside.', price: 2.5 },
          { name: 'Cheesecake', emoji: '🍰', description: 'With berry compote.', price: 5, available: false },
        ],
      },
      {
        name: 'Cold drinks',
        products: [
          { name: 'Mint Lemonade', emoji: '🍋', description: 'Fresh lemons and mint.', price: 3.5 },
          { name: 'Still Water', emoji: '💧', price: 1 },
        ],
      },
    ],
  },
};

function loadSample(store, lang) {
  const sample = SAMPLE[lang] || SAMPLE.en;
  store.updateSettings({
    tagline: store.settings.tagline || sample.tagline,
    about: store.settings.about || sample.about,
    hours: store.settings.hours || sample.hours,
  });
  for (const c of sample.categories) {
    const cat = store.addCategory({ name: c.name });
    for (const p of c.products) {
      store.addProduct({
        categoryId: cat.id,
        name: p.name,
        description: p.description || '',
        price: p.price || (p.variants ? p.variants[0][1] : 0),
        comparePrice: 0,
        image: '',
        emoji: p.emoji || '',
        available: p.available !== false,
        featured: !!p.featured,
        variants: (p.variants || []).map(([name, price]) => ({ name, price })),
      });
    }
  }
}

module.exports = { loadSample };
