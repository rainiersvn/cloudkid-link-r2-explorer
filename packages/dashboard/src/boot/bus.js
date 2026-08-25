import { EventBus } from "quasar";
import { defineBoot } from "#q-app/wrappers";

export default defineBoot(({ app }) => {
	const bus = new EventBus();

	// for Options API
	app.config.globalProperties.$bus = bus;

	// for Composition API
	app.provide("bus", bus);
});
