import type { Product } from '../types';

import { PRODUCT_PHOTOS } from './productImageMap';

// Photos are served from public/products/<key>.jpg (free Unsplash images, stored locally
// so product cards load fast and also work without internet).
const photo = (key: string) => `/products/${key}.jpg`;

// For products not in the catalogue map (e.g. newly added ones): match words in the name.
// More specific patterns come first.
const keywordPhotos: Array<[RegExp, string]> = [
  [/coca.?cola|coke/i, 'coke-cans'],
  [/sprite|7up|soda|lemon.?lime/i, 'soda-can'],
  [/\bcola\b/i, 'cola-glass'], // whole word: "chocolate" contains "cola"
  [/red bull|energy drink/i, 'red-bull'],
  [/water/i, 'water-bottle'],
  [/mango|juice|frooto/i, 'mango-drink'],
  [/green tea/i, 'green-tea'],
  [/coffee|nescaf/i, 'coffee'],
  [/\btea\b/i, 'tea'],
  [/malt|horlicks/i, 'malt-drink'],
  [/egg/i, 'eggs'],
  [/milk powder/i, 'milk'],
  [/paneer/i, 'paneer'],
  [/ghee/i, 'ghee'],
  [/butter(?! cookie| bite)/i, 'butter'],
  [/cheese/i, 'cheese'],
  [/curd|doi|yogurt|yoghurt/i, 'yogurt'],
  [/milk(?! bread)/i, 'milk'],
  [/bread|toast|bun/i, 'white-bread'],
  [/corn ?flakes|cereal/i, 'cornflakes'],
  [/oats/i, 'oats'],
  [/jam|jelly/i, 'jam'],
  [/peanut butter|nutella|spread/i, 'peanut-butter'],
  [/ketchup|tomato sauce|chilli sauce|chili sauce|sauce/i, 'tomato-sauce'],
  [/apple/i, 'apples'],
  [/banana|kola/i, 'bananas'],
  [/orange|malta/i, 'oranges'],
  [/lemon|lebu/i, 'lemons'],
  [/grape/i, 'grapes'],
  [/papaya/i, 'papaya'],
  [/guava|peyara/i, 'guava'],
  [/pear/i, 'pears'],
  [/tomato/i, 'tomatoes'],
  [/potato|alu/i, 'potatoes'],
  [/onion|peyaj/i, 'onions'],
  [/garlic|roshun/i, 'garlic'],
  [/ginger|\bada\b/i, 'ginger'],
  [/cucumber|shosha/i, 'cucumbers'],
  [/chili|chilli|morich/i, 'green-chilies'],
  [/coriander leaf|dhone pata/i, 'coriander'],
  [/turmeric|holud/i, 'turmeric'],
  [/cardamom|elach/i, 'cardamom'],
  [/biryani/i, 'biryani'],
  [/masala|spice|cumin|jira|powder/i, 'spices'],
  [/salt/i, 'salt'],
  [/sugar/i, 'sugar'],
  [/atta|maida|flour/i, 'flour'],
  [/dal|lentil/i, 'lentils'],
  [/chickpea|chola/i, 'chickpeas'],
  [/rice/i, 'rice'],
  [/olive oil/i, 'olive-oil'],
  [/coconut oil/i, 'coconut-oil'],
  [/oil/i, 'oil-jug'],
  [/shrimp|prawn|chingri/i, 'shrimp'],
  [/fish|hilsa|hilsha|rui|katla|pabda/i, 'whole-fish'],
  [/drumstick|fried chicken/i, 'fried-chicken'],
  [/nugget/i, 'nuggets'],
  [/popcorn|tender/i, 'chicken-tenders'],
  [/kebab|kabab/i, 'kebab'],
  [/spring roll|samosa/i, 'spring-rolls'],
  [/paratha|roti/i, 'paratha'],
  [/breast|fillet/i, 'raw-chicken'],
  [/chicken/i, 'whole-chicken'],
  [/mutton|lamb/i, 'mutton'],
  [/beef|meat/i, 'raw-beef'],
  [/pasta|penne|spaghetti/i, 'pasta'],
  [/spicy.*noodle|buldak/i, 'spicy-noodles'],
  [/noodle/i, 'stir-fry-noodles'],
  [/soup/i, 'soup'],
  [/ice cream tub|vanilla/i, 'ice-cream-scoops'],
  [/ice cream|chocobar|kulfi/i, 'ice-cream-bar'],
  [/rosogolla|rasgulla|gulab jamun|mishti|sweets/i, 'gulab-jamun'],
  [/dark chocolate/i, 'truffles'],
  [/chocolate|cadbury|kitkat|snickers/i, 'chocolate-bars'],
  [/candy|mint|gummy|lollipop/i, 'gummies'],
  [/chips|crisps|kurkure/i, 'chips'],
  [/cashew/i, 'cashews'],
  [/chanachur|nuts|almond/i, 'almonds'],
  [/oreo/i, 'chocolate-cookies'],
  [/biscuit|cookie/i, 'cookies'],
  [/toothpaste|paste/i, 'toothpaste'],
  [/toothbrush/i, 'toothbrushes'],
  [/mouthwash/i, 'mouthwash'],
  [/razor|shav/i, 'razor'],
  [/shampoo|body wash|conditioner/i, 'shampoo'],
  [/soap/i, 'soap-bars'],
  [/diaper|nappy/i, 'diapers'],
  [/baby/i, 'baby-feet'],
  [/cat litter|litter/i, 'kitten'],
  [/cat/i, 'cat-food'],
  [/dog/i, 'dog-biscuits'],
  [/capsule/i, 'capsules'],
  [/tablet|paracetamol|medicine/i, 'tablets'],
  [/bandage|plaster|first aid/i, 'first-aid'],
  [/detergent|washing powder|laundry/i, 'laundry'],
  [/dishwash|dish wash/i, 'kitchen-sink'],
  [/disinfectant|antiseptic/i, 'cleaning-spray'],
  [/cleaner|mosquito|spray/i, 'cleaning-spray'],
  [/facial tissue|tissue box/i, 'tissue-box'],
  [/tissue|toilet|towel/i, 'toilet-rolls'],
  [/batter(y|ies)/i, 'batteries'],
  [/paper|a4/i, 'printer-paper'],
  [/khata|notebook|exercise book/i, 'notebook'],
  [/pen\b|pens\b|pencil|glue/i, 'pen'],
];

// Last resort: the product's category or department.
const categoryPhotos: Array<[RegExp, string]> = [
  [/fruit/i, 'apples'],
  [/vegetable/i, 'tomatoes'],
  [/meat|poultry/i, 'raw-beef'],
  [/fish|seafood/i, 'whole-fish'],
  [/dairy|chilled|egg/i, 'milk'],
  [/bakery|breakfast/i, 'white-bread'],
  [/beverage|cold drink/i, 'drink-cans'],
  [/tea|coffee/i, 'tea'],
  [/ice cream|dessert/i, 'ice-cream-scoops'],
  [/chocolate|candy/i, 'chocolate-bars'],
  [/snack|biscuit/i, 'cookies'],
  [/frozen|ready meal/i, 'nuggets'],
  [/noodle|pasta|soup/i, 'pasta'],
  [/rice|flour|grain/i, 'rice'],
  [/daily essential/i, 'flour'],
  [/oil|ghee/i, 'oil-jug'],
  [/spice|seasoning/i, 'spices'],
  [/sauce|pickle|spread/i, 'tomato-sauce'],
  [/cleaning|laundry/i, 'laundry'],
  [/household/i, 'toilet-rolls'],
  [/oral|grooming/i, 'toothbrushes'],
  [/personal care|bath|beauty/i, 'soap-bars'],
  [/health|wellness/i, 'first-aid'],
  [/baby|diaper/i, 'baby-feet'],
  [/pet/i, 'cat-food'],
  [/stationery|batter/i, 'notebook'],
];

export const getProductImage = (product: Product): string => {
  if (product.image_url?.trim()) return product.image_url;

  const exact = PRODUCT_PHOTOS[product.name_en];
  if (exact) return photo(exact);

  const keywordMatch = keywordPhotos.find(([pattern]) => pattern.test(product.name_en));
  if (keywordMatch) return photo(keywordMatch[1]);

  const categoryText = `${product.category_name || ''} ${product.department || ''}`;
  const categoryMatch = categoryPhotos.find(([pattern]) => pattern.test(categoryText));
  return photo(categoryMatch?.[1] || 'groceries');
};

export const getProductFallback = (product: Product): string => {
  const text = `${product.name_en} ${product.category_name || ''} ${product.department || ''}`.toLowerCase();
  const emoji =
    /fruit|apple|banana|orange|grape|papaya/.test(text) ? '🍎' :
    /vegetable|tomato|potato|onion|garlic|ginger/.test(text) ? '🥬' :
    /meat|beef|mutton/.test(text) ? '🥩' :
    /chicken|poultry/.test(text) ? '🍗' :
    /fish|seafood|hilsa/.test(text) ? '🐟' :
    /milk|dairy/.test(text) ? '🥛' :
    /egg/.test(text) ? '🥚' :
    /bread|bakery|biscuit/.test(text) ? '🥖' :
    /coffee|tea/.test(text) ? '☕' :
    /drink|beverage|juice|water/.test(text) ? '🧃' :
    /ice cream|dessert/.test(text) ? '🍨' :
    /chocolate|candy/.test(text) ? '🍫' :
    /rice|grain|flour|atta/.test(text) ? '🌾' :
    /cleaning|laundry/.test(text) ? '🧼' :
    /personal|bath|oral|grooming/.test(text) ? '🧴' :
    /baby|diaper/.test(text) ? '🍼' :
    /pet/.test(text) ? '🐾' : '🛍️';

  const label = product.brand || product.category_name || 'NovaMart';
  const safeLabel = label.replace(/[&<>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff7fa"/><stop offset="1" stop-color="#fce0eb"/></linearGradient></defs><rect width="640" height="480" rx="32" fill="url(#g)"/><circle cx="320" cy="210" r="126" fill="#fff" opacity=".86"/><text x="320" y="254" text-anchor="middle" font-size="120">${emoji}</text><text x="320" y="405" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="#a11350">${safeLabel}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

