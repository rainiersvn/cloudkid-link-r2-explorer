<template>
  <q-page class='flex flex-center login-page'>
    <q-card class='q-pa-md shadow-2 login-card' bordered>
      <q-card-section class='text-center'>
        <div class='text-h5 text-brand-gradient text-weight-bold'>Sign in</div>
        <div class='text-grey-5'>Enter your email address and password to access admin panel.</div>
      </q-card-section>

      <q-card-section v-if='showError'>
        <q-banner inline-actions class="text-white bg-red">
          {{ showError }}
        </q-banner>
      </q-card-section>

      <q-card-section>
        <q-form
          @submit="onSubmit"
          class="q-gutter-sm"
        >
          <q-input
            filled
            v-model="form.username"
            label="Username"
            lazy-rules
            type='text'
          />

          <q-input
            filled
            v-model="form.password"
            label="Password"
            lazy-rules
            type='password'
          />

          <q-toggle v-model="form.remind" label="Remember me" />

          <div>
            <q-btn :loading="loading" label="Sign in" type="submit" color="primary"/>
          </div>
        </q-form>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script>
import { useAuthStore } from "stores/auth-store";
import { defineComponent } from "vue";
const authStore = useAuthStore();

export default defineComponent({
	name: "login-page",
	components: {},
	data() {
		return {
			loading: false,
			showError: "",
			form: {
				username: "",
				password: "",
				remind: true,
			},
		};
	},
	methods: {
		async onSubmit() {
			this.loading = true;
			try {
				await authStore.LogIn(this.$router, this.form);
				this.showError = "";
			} catch (error) {
				this.showError = error.message;
				throw error;
			} finally {
				this.loading = false;
			}
		},
	},
});
</script>

<style scoped>
.login-page {
  background:
    radial-gradient(ellipse 80% 60% at 50% -10%, rgba(141, 52, 244, 0.3), transparent),
    radial-gradient(ellipse 60% 50% at 80% 90%, rgba(244, 192, 37, 0.08), transparent);
}

.login-card {
  width: 100%;
  max-width: 380px;
  border-radius: 16px;
  box-shadow: 0 0 40px rgba(141, 52, 244, 0.25), 0 8px 32px -8px rgba(4, 4, 7, 0.5);
}
</style>
