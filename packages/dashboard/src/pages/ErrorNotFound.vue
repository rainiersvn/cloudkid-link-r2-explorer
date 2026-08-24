<template>
  <div class="fullscreen text-white text-center q-pa-md flex flex-center" style="background-color: #09080c">
    <div>
      <div class="text-brand-gradient" style="font-size: 30vh">
        404
      </div>

      <div class="text-h2" style="opacity:.4">
        Oops. Nothing here...
      </div>

      <q-btn
        class="btn-cta q-mt-xl"
        unelevated
        to="/"
        label="Go Home"
        no-caps
      />
    </div>
  </div>
</template>

<script>
import { defineComponent } from "vue";

export default defineComponent({
	name: "ErrorNotFound",
});
</script>
