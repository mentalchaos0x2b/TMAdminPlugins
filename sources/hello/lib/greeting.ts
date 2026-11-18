/**
 * Вспомогательная функция форматирования приветствия для блока Hello.vue.
 */
export function formatGreeting(name?: string): string {
  if (!name || name.trim() === "") {
    return "Привет из плагина TMAdmin!";
  }
  return `Привет, ${name.trim()}!`;
}
